// Middleware redirects "/" by role; this renders only if middleware is bypassed.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/login");
}
