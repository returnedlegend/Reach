import { PantryDetail } from "@/components/pantry-detail";

export default async function PantryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main id="main-content">
      <PantryDetail id={id} />
    </main>
  );
}
