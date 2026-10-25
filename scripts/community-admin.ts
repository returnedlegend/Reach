import { createModerator, setSoleModerator } from "../src/lib/community";
const [command, username, ...extra] = process.argv.slice(2);
if (command === "set-sole-moderator" && username && !extra.length) {
  try {
    const { revoked } = setSoleModerator(username);
    console.log(
      `Verified account is now the sole community moderator. Removed moderator access from ${revoked} other account(s).`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Could not assign moderator.",
    );
    process.exitCode = 1;
  }
} else if (command !== "create-moderator" || !username || extra.length) {
  console.error(
    "Usage: npm run community:admin -- set-sole-moderator VERIFIED_EMAIL\nOr: npx tsx scripts/community-admin.ts create-moderator USERNAME\nSet REACH_COMMUNITY_ADMIN_PASSWORD or pipe the password on standard input. Passwords are never accepted as arguments.",
  );
  process.exitCode = 1;
} else {
  try {
    let password = process.env.REACH_COMMUNITY_ADMIN_PASSWORD;
    if (!password) {
      if (process.stdin.isTTY)
        throw new Error(
          "Provide the password through REACH_COMMUNITY_ADMIN_PASSWORD or piped standard input.",
        );
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        size += Buffer.byteLength(chunk);
        if (size > 256) throw new Error("Password input is too long.");
        chunks.push(Buffer.from(chunk));
      }
      password = Buffer.concat(chunks)
        .toString("utf8")
        .replace(/\r?\n$/, "");
    }
    createModerator(username, password);
    console.log(
      "Moderator account created. This development pilot requires operational review before public deployment.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Could not create moderator.",
    );
    process.exitCode = 1;
  }
}
