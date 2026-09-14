"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { IllegalTransitionError, transitionTask } from "../../../application/commands/tasks/transitionTask";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";
import type { TaskCommand } from "../../../domain/tasks/task";

export interface TaskActionState {
  error?: string;
}

export async function submitTaskTransition(_prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const { actor, householdId } = await requireActor();

  const taskId = String(formData.get("taskId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  const action = String(formData.get("action") ?? "");

  let command: TaskCommand;
  switch (action) {
    case "start":
      // "Start" means "I am working on this", so it assigns the acting
      // person as owner when the task has none — state-machines.md requires
      // IN_PROGRESS to have an owner, and bouncing the user to a separate
      // assignment step to satisfy a rule they didn't ask about would be
      // friction with no safety benefit.
      command = { type: "START", ownerPersonId: actor.personIds[0] ?? "" };
      break;
    case "resume":
      command = { type: "RESUME", ownerPersonId: actor.personIds[0] };
      break;
    case "complete":
      command = { type: "COMPLETE" };
      break;
    case "cancel":
      command = { type: "CANCEL", reason: null };
      break;
    case "reopen":
      command = { type: "REOPEN" };
      break;
    case "plan":
      command = { type: "PLAN" };
      break;
    default:
      return { error: "invalid_input" };
  }

  try {
    await transitionTask(actor, householdId, taskId, expectedVersion, command);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return {
        error:
          error.code === "OWNER_REQUIRED"
            ? "owner_required"
            : error.code === "FOLLOW_UP_REQUIRED"
              ? "follow_up_required"
              : "illegal_transition",
      };
    }
    if (error instanceof ConflictError) return { error: "conflict" };
    if (error instanceof AuthorizationError) return { error: "not_authorized" };
    if (error instanceof NotFoundError) return { error: "conflict" };
    throw error;
  }

  revalidatePath("/tasks");
  revalidatePath("/today");
  revalidatePath("/attention");
  return {};
}
