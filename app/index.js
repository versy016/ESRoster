import { Redirect } from "expo-router";

export default function Home() {
  // Redirect to roster as the default screen
  return <Redirect href="/roster" />;
}
