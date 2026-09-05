import Workspace from "./components/workspace";
import baseRules from "@/lib/base-rules.json";
import { getStorageMode } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default function Home() {
  const counts: Record<string, number> = {};
  for (const rule of baseRules) {
    const parts = rule.split(",");
    const target = parts.at(-1) === "no-resolve" ? parts.at(-2) : parts.at(-1);
    if (
      target &&
      !["DIRECT", "REJECT", "REJECT-DROP", "PASS", "GLOBAL"].includes(target)
    )
      counts[target] = (counts[target] ?? 0) + 1;
  }
  const storageMode = getStorageMode();
  return (
    <Workspace
      key={storageMode}
      baseCounts={counts}
      baseCount={baseRules.length}
      storageMode={storageMode}
    />
  );
}
