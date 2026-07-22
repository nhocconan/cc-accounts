// cca — Claude Code multi-account switcher. Entry point + command dispatcher.
//
// The shebang is added by tsup's banner config at build time.
//
// Busybox-style self-dispatch: when invoked through a claude-<slug> symlink
// (e.g. /usr/local/bin/claude-work → this binary), it launches that account
// directly, passing through all args to claude.
import { basename } from "node:path";
import * as tui from "./tui.ts";
import * as cmdList from "./commands/list.ts";
import * as cmdAdd from "./commands/add.ts";
import * as cmdLaunch from "./commands/launch.ts";
import * as cmdRefresh from "./commands/refresh.ts";
import * as cmdRemove from "./commands/remove.ts";
import * as cmdEdit from "./commands/edit.ts";
import * as cmdDoctor from "./commands/doctor.ts";
import * as cmdSync from "./commands/sync.ts";
import * as cmdStatusline from "./commands/statusline.ts";

function selfName(): string {
  // process.argv[1] is the path the binary was invoked as. Through a symlink,
  // this is the symlink path (NOT the resolved target) on Node — so the basename
  // tells us which claude-<slug> launcher was used.
  return basename(process.argv[1] || "cca");
}

async function main(): Promise<number> {
  const invoked = selfName();
  const args = process.argv.slice(2);

  // --- Busybox dispatch: invoked as claude-<slug> → launch that account. ---
  if (invoked.startsWith("claude-") && invoked !== "claude-accounts") {
    const slug = invoked.slice("claude-".length);
    return cmdLaunch.launch(slug, args);
  }

  // --- Normal cca command dispatch. ---
  const [sub, ...rest] = args;
  const flags = parseFlags(rest);

  switch (sub) {
    case undefined:
      // No subcommand → interactive TUI.
      return tui.run();
    case "statusline":
      await cmdStatusline.run();
      return 0;
    case "doctor":
      await cmdDoctor.doctor();
      return 0;
    case "list":
    case "ls":
      await cmdList.list();
      return 0;
    case "launch":
    case "run": {
      const slug = flags.positionals[0];
      if (!slug) throw new Error("usage: cca launch <slug> [claude args...]");
      return cmdLaunch.launch(slug, [...flags.positionals.slice(1), ...flags.unknown]);
    }
    case "add": {
      const addOpts: cmdAdd.AddOptions = {};
      if (flags.values["name"]) addOpts.name = flags.values["name"];
      if (flags.values["slug"]) addOpts.slug = flags.values["slug"];
      if (flags.values["token"]) addOpts.token = flags.values["token"];
      if (flags.values["settings"]) addOpts.settings = flags.values["settings"];
      await cmdAdd.add(addOpts);
      return 0;
    }
    case "refresh": {
      const slug = flags.positionals[0] || flags.values["slug"];
      if (!slug) throw new Error("usage: cca refresh <slug>");
      const refreshOpts: cmdRefresh.RefreshOptions = {};
      if (flags.values["token"]) refreshOpts.token = flags.values["token"];
      await cmdRefresh.refresh(slug, refreshOpts);
      return 0;
    }
    case "remove":
    case "rm": {
      const slug = flags.positionals[0];
      if (!slug) throw new Error("usage: cca remove <slug>");
      await cmdRemove.remove(slug);
      return 0;
    }
    case "edit": {
      const slug = flags.positionals[0];
      if (!slug) throw new Error("usage: cca edit <slug>");
      const editOpts: cmdEdit.EditOptions = {};
      if (flags.values["name"]) editOpts.name = flags.values["name"];
      if (flags.values["slug"]) editOpts.slug = flags.values["slug"];
      if (flags.values["settings"]) editOpts.settings = flags.values["settings"];
      await cmdEdit.edit(slug, editOpts);
      return 0;
    }
    case "sync":
      await cmdSync.sync();
      return 0;
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return 0;
    case "--version":
    case "-V":
      console.log(VERSION);
      return 0;
    default:
      console.error(`unknown command "${sub}" (try --help)`);
      return 1;
  }
}

interface ParsedFlags {
  positionals: string[];
  values: Record<string, string>;
  unknown: string[];
}

/** Minimal flag parser: --key=val / --key val / -k val; positionals captured. */
function parseFlags(args: string[]): ParsedFlags {
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      // Pass everything after -- through to claude verbatim.
      unknown.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        values[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          values[key] = next;
          i++;
        } else {
          values[key] = "true";
        }
      }
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      // Treat -k as --k (short flag passthrough for claude args like -p).
      unknown.push(a);
    } else {
      positionals.push(a);
    }
  }
  return { positionals, values, unknown };
}

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`cca — Claude Code multi-account switcher v${VERSION}

usage: cca [command]

  (no command)    interactive account picker + actions
  list            list configured accounts with usage meters
  add             register a new account (runs claude setup-token)
                  options: --name <label> --slug <suffix> --token <tok>
  refresh <slug>  replace an account's token
                  options: --token <tok>
  remove <slug>   delete an account and its token
  edit <slug>     change label / slug / settings overrides
                  options: --name --slug --settings <json|clear>
  launch <slug>   launch Claude as that account (also: claude-<slug>)
  sync            rebuild launchers + refresh config dirs
  doctor          audit tokens, isolation, and same-account collisions
  statusline      (internal) render the in-session status line

Each configured account also dispatches directly as: claude-<slug>
e.g. claude-work, claude-personal, claude-team
`);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
