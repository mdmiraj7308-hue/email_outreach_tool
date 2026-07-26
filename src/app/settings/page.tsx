import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Settings</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Connect your accounts and configure how campaigns run.
        </p>
      </div>
      <SettingsForm />
    </div>
  );
}
