import { Suspense } from "react";
import { MomentView } from "./MomentView";

export default function MomentPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Загрузка…</p></main>}>
      <MomentView />
    </Suspense>
  );
}
