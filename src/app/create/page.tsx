import StoryQuiz from "./quiz";
import { GENRE_LIST } from "@/lib/songcraft/registry";

export default function CreatePage() {
  return <StoryQuiz genres={GENRE_LIST} />;
}
