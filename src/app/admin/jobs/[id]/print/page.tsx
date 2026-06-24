import ManualPrint from "@/components/ManualPrint";

export default async function ManualPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManualPrint id={id} />;
}
