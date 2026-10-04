import { Suspense } from "react";
import { NewMoment } from "./NewMoment";

export default function NewMomentPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Загрузка…</p></main>}>
      <NewMoment />
    </Suspense>
  );
}
