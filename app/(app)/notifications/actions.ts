"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { markNotificationsRead } from "../../../application/commands/notifications/markNotificationsRead";

export async function markAllReadAction(): Promise<void> {
  const { actor } = await requireActor();
  await markNotificationsRead(actor);
  revalidatePath("/notifications");
  revalidatePath("/today");
}
