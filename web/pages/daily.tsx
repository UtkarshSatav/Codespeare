import { useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { dailyProblem } from "@/lib/problems";

export default function Daily() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/problems/${dailyProblem().slug}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Layout>
      <p className="text-muted">loading today&apos;s problem…</p>
    </Layout>
  );
}
