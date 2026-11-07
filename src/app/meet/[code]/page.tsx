import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseMeetingCode } from "@/lib/identity";
import { RoomLoader } from "./RoomLoader";

type Props = PageProps<"/meet/[code]">;

export default function MeetingPage({ params }: Props) {
  return (
    <Suspense>
      <Meeting params={params} />
    </Suspense>
  );
}

async function Meeting({ params }: Pick<Props, "params">) {
  const { code } = await params;
  const parsed = parseMeetingCode(code);
  if (!parsed) notFound();
  return <RoomLoader code={parsed} />;
}
