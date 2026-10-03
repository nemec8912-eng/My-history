import { Suspense } from "react";
import { PlaceView } from "./PlaceView";

export default function PlacePage() {
  return (
    <Suspense fallback={<main className="shell"><p className="muted">Загрузка…</p></main>}>
      <PlaceView />
    </Suspense>
  );
}
