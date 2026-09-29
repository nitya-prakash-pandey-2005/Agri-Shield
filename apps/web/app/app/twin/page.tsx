import { Suspense } from "react";
import TwinApp from "@/components/twin/TwinApp";

export const metadata = { title: "Earth Twin" };

export default function Page() {
  return (
    <Suspense>
      <TwinApp />
    </Suspense>
  );
}
