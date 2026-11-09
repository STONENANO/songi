import Quiz from "./quiz";
import { GENRE_LIST, MOODS, OCCASIONS, RELATIONSHIPS } from "@/lib/songcraft/registry";

export default function CreatePage() {
  return <Quiz genres={GENRE_LIST} moods={[...MOODS]} occasions={[...OCCASIONS]} relationships={[...RELATIONSHIPS]} />;
}
