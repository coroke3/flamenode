"use server";

import { signOut } from "@/lib/auth";

export async function authSignOut(): Promise<void> {
  await signOut({ redirectTo: "/entry" });
}
