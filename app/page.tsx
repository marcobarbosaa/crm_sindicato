import { EntryExperience } from "./entry-experience";

export default function Home() {
  return (
    <EntryExperience
      user={{ displayName: "Administrador", email: "admin@prospecta.local" }}
      accessHref="/workspace"
    />
  );
}
