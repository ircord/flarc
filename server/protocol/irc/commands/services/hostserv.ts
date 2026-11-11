import type { SessionAttachment } from "~/core/types";
import { Numerics } from "~/protocol/irc/numerics";
import { canonicalizeIRCName } from "~/protocol/irc/parser";
import { handleChghost } from "../oper";
import type { ISessionDO } from "../types";
import { sendServiceResponse } from "./helpers";

export async function handleHostServ(
  session: ISessionDO,
  ws: WebSocket,
  attachment: SessionAttachment,
  rawText: string,
  labelTags?: Record<string, string | true>,
): Promise<void> {
  const parts = rawText.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "HELP").toUpperCase();
  const accountsStub = session.getAccountsStub();

  if (sub === "STATUS") {
    const targetAcct = parts[1] ?? attachment.accountName ?? "";
    if (!targetAcct) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        ["You must be logged in to check vhost status"],
        labelTags,
      );
      return;
    }
    const info = await accountsStub.getVhostInfo(targetAcct);
    sendServiceResponse(
      session,
      ws,
      attachment,
      "HostServ",
      [
        info.vhost
          ? `Account ${targetAcct} has vhost: ${info.vhost} (${info.enabled ? "enabled" : "disabled"})`
          : `Account ${targetAcct} has no vhost assigned`,
      ],
      labelTags,
    );
    return;
  }

  if (sub === "ON" || sub === "OFF") {
    if (!attachment.accountName) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        ["You must be logged in to toggle your vhost"],
        labelTags,
      );
      return;
    }
    const enable = sub === "ON";
    const res = await accountsStub.setVhostEnabled(attachment.accountName, enable);
    if (!res.ok || !res.vhost) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        ["No vhost is assigned to your account"],
        labelTags,
      );
      return;
    }
    const newHost = enable ? res.vhost : "irc.client";
    attachment.vhost = enable ? res.vhost : null;
    await handleChghost(
      session,
      ws,
      attachment,
      {
        tags: {},
        prefix: null,
        command: "CHGHOST",
        params: [attachment.username ?? "user", newHost],
      },
      undefined,
      true,
    );
    if (enable) {
      session.sendNumeric(ws, attachment, Numerics.RPL_HOSTHIDDEN, [
        res.vhost,
        "is now your hidden host",
      ]);
    }
    sendServiceResponse(
      session,
      ws,
      attachment,
      "HostServ",
      [`Successfully ${enable ? "enabled" : "disabled"} vhost ${res.vhost}`],
      labelTags,
    );
    return;
  }

  if (sub === "SET" || sub === "DEL") {
    if (!attachment.isOper) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        ["Insufficient privileges"],
        labelTags,
      );
      return;
    }
    const targetAcct = parts[1] ?? attachment.accountName ?? "";
    const vhost = sub === "SET" ? (parts[2] ?? "") : null;
    if (!targetAcct || (sub === "SET" && !vhost)) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        [`Syntax: /HS ${sub} <account>${sub === "SET" ? " <vhost>" : ""}`],
        labelTags,
      );
      return;
    }
    const ok = await accountsStub.setVhost(targetAcct, vhost);
    if (!ok) {
      sendServiceResponse(
        session,
        ws,
        attachment,
        "HostServ",
        [`Account ${targetAcct} does not exist`],
        labelTags,
      );
      return;
    }

    // Apply live to sessions of targetAcct
    const canon = canonicalizeIRCName(targetAcct);
    for (const { ws: sWs, attachment: sAtt } of session.sessionsById.values()) {
      if (sAtt.accountName && canonicalizeIRCName(sAtt.accountName) === canon) {
        sAtt.vhost = vhost;
        const nextHost = vhost ?? "irc.client";
        await handleChghost(
          session,
          sWs,
          sAtt,
          {
            tags: {},
            prefix: null,
            command: "CHGHOST",
            params: [sAtt.username ?? "user", nextHost],
          },
          undefined,
          true,
        );
        if (vhost) {
          session.sendNumeric(sWs, sAtt, Numerics.RPL_HOSTHIDDEN, [
            vhost,
            "is now your hidden host",
          ]);
        }
      }
    }

    sendServiceResponse(
      session,
      ws,
      attachment,
      "HostServ",
      [
        vhost
          ? `Successfully set vhost ${vhost} for account ${targetAcct}`
          : `Successfully deleted vhost for account ${targetAcct}`,
      ],
      labelTags,
    );
    return;
  }

  sendServiceResponse(
    session,
    ws,
    attachment,
    "HostServ",
    ["HostServ commands: ON, OFF, STATUS [account], SET <account> <vhost>, DEL <account>"],
    labelTags,
  );
}
