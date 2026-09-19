import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

const handler = serve({ client: inngest, functions });

export { handler as GET, handler as POST, handler as PUT };