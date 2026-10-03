import { Suspense } from "react";
import { TripView } from "./TripView";

export default function TripPage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Загрузка…</p></main>}>
      <TripView />
    </Suspense>
  );
}
