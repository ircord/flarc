"""irctest controller for CFCord.

Starts a fresh, ephemeral CFCord instance (Miniflare + raw TCP bridge) for every
test case, mirroring how irctest drives Ergo.

Usage (from .compliance/irctest):
    PYTHONPATH=../../compliance python -m pytest --controller cfcord_controller \
        -m '(Ergo or not implementation-specific) and not deprecated'
"""

import copy
import json
import os
import subprocess
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Type

from irctest import patma
from irctest.basecontrollers import BaseServerController, DirectoryBasedController
from irctest.cases import BaseServerTestCase
from irctest.runner import NotImplementedByController
from irctest.specifications import Capabilities, OptionalBehaviors

CFCORD_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_PATH = Path(os.environ.get("CFCORD_BUNDLE", str(CFCORD_ROOT / ".output" / "server" / "index.mjs")))


def _ensure_bundle() -> None:
    """Build the worker bundle if missing (run-irctest.sh prebuilds it once,
    so parallel xdist workers never race on the build)."""
    if os.environ.get("CFCORD_SKIP_BUNDLE") and BUNDLE_PATH.exists():
        return
    server_dir = CFCORD_ROOT / "server"
    newest = max(p.stat().st_mtime for p in server_dir.rglob("*.ts"))
    if BUNDLE_PATH.exists() and BUNDLE_PATH.stat().st_mtime >= newest:
        return
    subprocess.check_call(
        ["npm", "run", "build"],
        cwd=CFCORD_ROOT,
    )


class CFCordController(BaseServerController, DirectoryBasedController):
    software_name = "Ergo"
    _port_wait_interval = 0.05
    sync_sleep_time = 0.05
    supported_sasl_mechanisms = {"PLAIN", "SCRAM-SHA-256"}
    supports_sts = False
    extban_mute_char = "m"

    capabilities = frozenset(
        (
            Capabilities.ACCOUNT_NOTIFY,
            Capabilities.ACCOUNT_TAG,
            Capabilities.AWAY_NOTIFY,
            Capabilities.BATCH,
            Capabilities.ECHO_MESSAGE,
            Capabilities.EXTENDED_JOIN,
            Capabilities.EXTENDED_MONITOR,
            Capabilities.LABELED_RESPONSE,
            Capabilities.MESSAGE_TAGS,
            Capabilities.MULTILINE,
            Capabilities.MULTI_PREFIX,
            Capabilities.READ_MARKER,
            Capabilities.SERVER_TIME,
            Capabilities.SETNAME,
        )
    )

    optional_behaviors = frozenset(
        (
            OptionalBehaviors.BAN_EXCEPTION_MODE,
            OptionalBehaviors.CAP_REQ_MINUS,
            OptionalBehaviors.ELIST_M,
            OptionalBehaviors.ELIST_N,
            OptionalBehaviors.ELIST_U,
            OptionalBehaviors.INVITE_EXCEPTION_MODE,
            OptionalBehaviors.INVITE_LIST,
            OptionalBehaviors.INVITE_OVERRIDES_LIMIT,
            OptionalBehaviors.METADATA_BEFORE_CONNECT,
            OptionalBehaviors.MULTI_JOIN,
            OptionalBehaviors.MULTI_KICK,
            OptionalBehaviors.MULTI_NAMES_COMMAND,
            OptionalBehaviors.MULTI_PRIVMSG,
            OptionalBehaviors.NO_CTCP,
            OptionalBehaviors.SASL_AFTER_REGISTRATION,
            OptionalBehaviors.SASL_REAUTHENTICATION,
        )
    )

    isupport = {
        "BOT": "B",
        "CASEMAPPING": patma.ANYSTR,
        "ELIST": patma.StrRe(".*U.*"),
        "INVEX": patma.ANYOPTSTR,
        "MONITOR": patma.ANYSTR,
        "MSGREFTYPES": "msgid,timestamp",
        "PREFIX": "(qaohv)~&@%+",
        "STATUSMSG": "~&@%+",
        "TARGMAX": patma.ANYSTR,
        "UTF8ONLY": None,
        "WHOX": None,
    }

    def run(
        self,
        hostname: str,
        port: int,
        *,
        password: Optional[str],
        ssl: bool,
        run_services: bool,
        faketime: Optional[str],
        websocket_hostname: Optional[str] = None,
        websocket_port: Optional[int] = None,
        config=None,
    ) -> None:
        if ssl:
            raise NotImplementedByController("TLS")
        if faketime:
            raise NotImplementedByController("faketime")

        self._start_args = (hostname, port)
        self._start_kwargs = {
            "password": password,
            "ssl": ssl,
            "run_services": run_services,
            "faketime": faketime,
            "websocket_hostname": websocket_hostname,
            "websocket_port": websocket_port,
            "config": config,
        }
        self.create_config()
        _ensure_bundle()
        self.port = port
        self.hostname = hostname
        self._config = {
            "history": {
                "znc-maxmessages": 50,
            }
        }

        env = dict(os.environ)
        env["TCP_PORT"] = str(port)
        env["HOST"] = hostname
        if hasattr(self, "directory"):
            env["DURABLE_OBJECTS_PERSIST"] = str(self.directory / "durable_objects")

        if websocket_port is not None:
            http_port = websocket_port
        else:
            _, http_port = self.get_hostname_and_port()
        self.http_port = http_port
        env["HTTP_PORT"] = str(http_port)
        env["BUNDLE"] = str(BUNDLE_PATH)
        if password is not None:
            env["CFCORD_SERVER_PASSWORD"] = password
        cfg = config if config is not None else getattr(self, "test_config", None)
        if cfg is not None:
            if getattr(cfg, "account_registration_before_connect", None) is not None:
                env["CFCORD_REG_BEFORE_CONNECT"] = "1" if cfg.account_registration_before_connect else "0"
            if getattr(cfg, "account_registration_requires_email", None) is not None:
                env["CFCORD_REG_REQUIRES_EMAIL"] = "1" if cfg.account_registration_requires_email else "0"
            if getattr(cfg, "ergo_config", None):
                fake_cfg = {"accounts": {"multiclient": {}}, "server": {"listeners": {":": {}}}}
                try:
                    cfg.ergo_config(fake_cfg)
                    for _, conf in fake_cfg.get("server", {}).get("listeners", {}).items():
                        if conf and conf.get("proxy"):
                            env["CFCORD_PROXY_REQUIRED"] = "1"
                    default_modes = fake_cfg.get("accounts", {}).get("default-user-modes")
                    if default_modes:
                        env["CFCORD_DEFAULT_USER_MODES"] = default_modes
                    casemapping = fake_cfg.get("server", {}).get("casemapping")
                    if casemapping:
                        env["CFCORD_CASEMAPPING"] = casemapping
                    always_on = fake_cfg.get("accounts", {}).get("multiclient", {}).get("always-on")
                    if always_on in ("opt-out", "mandatory", True, "true"):
                        env["CFCORD_ALWAYS_ON_DEFAULT"] = "1"
                except Exception:
                    pass

        self.proc = self.execute(
            ["node", str(CFCORD_ROOT / "scripts" / "irctest-server.mjs")],
            cwd=CFCORD_ROOT,
            env=env,
        )
        self.wait_for_port()

    def restart(self) -> None:
        self.kill_proc()
        self.port_open = False
        self.run(*self._start_args, **self._start_kwargs)
        self.wait_for_port()

    def wait_for_services(self) -> None:
        pass

    def registerUser(
        self,
        case: BaseServerTestCase,
        username: str,
        password: Optional[str] = None,
    ) -> None:
        if not case.run_services:
            raise ValueError(
                "Attempted to register a nick, but `run_services` it not True."
            )
        assert password
        try:
            import urllib.request
            import json
            req = urllib.request.Request(
                f"http://127.0.0.1:{self.http_port}/api/accounts/register",
                data=json.dumps({"username": username, "password": password}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 201:
                    return
        except Exception:
            pass

        client = case.addClient(show_io=False)
        case.sendLine(client, "CAP LS 302")
        case.sendLine(client, "NICK " + username)
        case.sendLine(client, "USER r e g :user")
        case.sendLine(client, "CAP END")
        while case.getRegistrationMessage(client).command != "001":
            pass
        case.getMessages(client)
        case.sendLine(client, "NS REGISTER " + password)
        msg = case.getMessage(client)
        assert msg.params == [username, "Account created"], msg
        case.sendLine(client, "QUIT")
        case.assertDisconnected(client)

    def getConfig(self) -> Dict:
        return copy.deepcopy(self._config)

    def rehash(self, case: BaseServerTestCase, config: Dict) -> None:
        self._config = copy.deepcopy(config)
        znc_max = config.get("history", {}).get("znc-maxmessages", 50)
        http_port = getattr(self, "http_port", None) or (self.port + 1 if self.port else 8789)
        try:
            login_req = urllib.request.Request(
                f"http://127.0.0.1:{http_port}/api/v1/auth/login",
                data=json.dumps({"username": "ConformanceAdmin", "password": "conformance-admin-local-only"}).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urllib.request.urlopen(login_req, timeout=3) as login_resp:
                token = json.load(login_resp)["token"]
            req = urllib.request.Request(
                f"http://127.0.0.1:{http_port}/admin/config",
                data=json.dumps({"zncMaxMessages": znc_max}).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass


def get_irctest_controller_class() -> Type[CFCordController]:
    return CFCordController
