import { redirect } from "next/navigation";

// The timeline is the default module.
export default function Home() {
  redirect("/timeline");
}
