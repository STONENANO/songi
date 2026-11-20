import { redirect } from "next/navigation";

/** The Numbers tab is now Analytics; old links and bookmarks still work. */
export default function NumbersMoved() {
  redirect("/admin/analytics");
}
