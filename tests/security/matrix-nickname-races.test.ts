import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMatrixFixture, type MatrixActor } from "../helpers/matrix-fixture";
import type { TestIRCClient } from "../helpers/miniflare-harness";

type Fixture = Awaited<ReturnType<typeof createMatrixFixture>>;
async function command(client: TestIRCClient, line: string, match: RegExp) {
  const result = client.waitForNewLine((value) => match.test(value));
  client.send(line);
  return result;
}
async function delivery(
  f: Fixture,
  sender: TestIRCClient,
  winner: TestIRCClient,
  loser: TestIRCClient,
  target: string,
  loserNick: string,
) {
  const marker = `to-owner-${randomUUID()}`;
  const expected = winner.waitForNewLine((line) => line.includes(` PRIVMSG ${target} :${marker}`));
  sender.send(`PRIVMSG ${target} :${marker}`);
  await expected;
  await f.barrier(loser);
  expect(loser.lines.join("\n")).not.toContain(marker);
  expect(sender.lines.join("\n")).not.toContain(marker);
  const control = `to-loser-${randomUUID()}`;
  const legitimate = loser.waitForNewLine((line) =>
    line.includes(` PRIVMSG ${loserNick} :${control}`),
  );
  sender.send(`PRIVMSG ${loserNick} :${control}`);
  await legitimate;
  await f.barrier(winner);
  expect(winner.lines.join("\n")).not.toContain(control);
}
async function snapshots(f: Fixture, owner: MatrixActor, loser: MatrixActor, nickname: string) {
  await f.stop();
  const rows = (await f.snapshot("registered_nicks")).flat() as any[];
  expect(rows.filter((row) => row.nickname === nickname)).toEqual([
    expect.objectContaining({ nickname, user_id: owner.account.id }),
  ]);
  expect(rows.filter((row) => row.user_id === loser.account.id).map((row) => row.nickname)).toEqual(
    [loser.username],
  );
  expect(rows).toContainEqual(
    expect.objectContaining({ nickname: owner.username, user_id: owner.account.id }),
  );
  expect(rows).toHaveLength(4);
  expect((await f.snapshot("account_roles")).flat()).toEqual([]);
  const users = (await f.snapshot("users")).flat() as any[];
  expect(users).toHaveLength(3);
  expect(users.find((row) => row.id === owner.account.id)?.canonical_username).toBe(owner.username);
  expect(users.find((row) => row.id === loser.account.id)?.canonical_username).toBe(loser.username);
}

it("[ABUSE-015] competing casefolded live nick claims have one routed owner, retained by NickServ grouping after restart", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    const responses = [a, b].map((client) =>
      client.waitForNewLine((line) => / NICK :?RaceNick| 433 /i.test(line)),
    );
    a.send("NICK RaceNick");
    b.send("NICK rACEnICK");
    const lines = await Promise.all(responses);
    expect(lines.filter((line) => / NICK :?racenick/i.test(line))).toHaveLength(1);
    expect(lines.filter((line) => / 433 .*Nickname is already in use/i.test(line))).toHaveLength(1);
    const winnerIndex = lines.findIndex((line) => / NICK :?racenick/i.test(line));
    const winner = [a, b][winnerIndex],
      loser = [a, b][1 - winnerIndex];
    const owner = [alice, bob][winnerIndex],
      other = [alice, bob][1 - winnerIndex];
    const nick = winnerIndex === 0 ? "RaceNick" : "rACEnICK";
    const grouped = await command(
      winner,
      "NS GROUP",
      /Successfully grouped nickname .* to account/i,
    );
    expect(grouped).toContain(`Successfully grouped nickname ${nick} to account ${owner.username}`);
    await command(loser, "NICK RACENICK", / 433 .*Nickname belongs to another account/i);
    await delivery(f, c, winner, loser, nick, other.username);
    await snapshots(f, owner, other, "racenick");
    await f.restart();
    const win2 = await f.connect(owner),
      lose2 = await f.connect(other),
      c2 = await f.connect(charlie);
    await command(lose2, "NICK RACENICK", / 433 .*Nickname belongs to another account/i);
    await command(win2, `NICK ${nick}`, / NICK :?racenick/i);
    await delivery(f, c2, win2, lose2, nick, other.username);
    await snapshots(f, owner, other, "racenick");
  } finally {
    await f.dispose();
  }
}, 60000);

it("[ABUSE-015] simultaneous REST account-name case variants have one persistent owner and reject the other credentials", async () => {
  const f = await createMatrixFixture();
  try {
    const alice = await f.createActor("alice"),
      bob = await f.createActor("bob"),
      charlie = await f.createActor("charlie");
    const a = await f.connect(alice),
      b = await f.connect(bob),
      c = await f.connect(charlie);
    const names = ["ClaimName", "cLAIMnAME"],
      passwords = [`First-${randomUUID()}!`, `Second-${randomUUID()}!`];
    const responses = await Promise.all(
      names.map((username, i) =>
        f.request("/api/v1/auth/register", null, "POST", { username, password: passwords[i] }),
      ),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(1);
    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const loserIndex = 1 - winnerIndex;
    expect(await responses[loserIndex].text()).toContain("Account or nickname already exists");
    const created = (await responses[winnerIndex].json()) as any;
    const winner = await f.login(names[winnerIndex], passwords[winnerIndex]);
    expect(created.account.id).toBe(winner.account.id);
    const rejected = await f.request("/api/v1/auth/login", null, "POST", {
      username: names[loserIndex],
      password: passwords[loserIndex],
    });
    expect(rejected.status).toBe(401);
    const owner = await f.connect(winner, names[winnerIndex]);
    await command(a, "NICK CLAIMNAME", / 433 .*Nickname belongs to another account/i);
    await command(b, "NICK claimname", / 433 .*Nickname belongs to another account/i);
    await delivery(f, c, owner, a, names[winnerIndex], alice.username);
    await delivery(f, c, owner, b, names[winnerIndex], bob.username);
    await f.stop();
    const nicks = (await f.snapshot("registered_nicks")).flat() as any[];
    expect(nicks.filter((row) => row.nickname === "claimname")).toEqual([
      expect.objectContaining({ user_id: winner.account.id }),
    ]);
    expect(nicks).toHaveLength(4);
    expect((await f.snapshot("account_roles")).flat()).toEqual([]);
    const users = (await f.snapshot("users")).flat() as any[];
    expect(users).toHaveLength(4);
    expect(users.filter((row) => row.canonical_username === "claimname")).toEqual([
      expect.objectContaining({ id: winner.account.id }),
    ]);
    await f.restart();
    const again = await f.login(names[winnerIndex], passwords[winnerIndex]);
    expect(again.account.id).toBe(winner.account.id);
    expect(
      (
        await f.request("/api/v1/auth/login", null, "POST", {
          username: names[loserIndex],
          password: passwords[loserIndex],
        })
      ).status,
    ).toBe(401);
    const a2 = await f.connect(alice),
      b2 = await f.connect(bob),
      c2 = await f.connect(charlie),
      owner2 = await f.connect(again, names[winnerIndex]);
    await command(a2, "NICK claimname", / 433 .*Nickname belongs to another account/i);
    await command(b2, "NICK CLAIMNAME", / 433 .*Nickname belongs to another account/i);
    await delivery(f, c2, owner2, a2, names[winnerIndex], alice.username);
    await delivery(f, c2, owner2, b2, names[winnerIndex], bob.username);
    await f.stop();
    expect(
      ((await f.snapshot("registered_nicks")).flat() as any[]).filter(
        (row) => row.nickname === "claimname",
      ),
    ).toEqual([expect.objectContaining({ user_id: winner.account.id })]);
  } finally {
    await f.dispose();
  }
}, 60000);
