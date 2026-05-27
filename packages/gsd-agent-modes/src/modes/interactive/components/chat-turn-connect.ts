// Project/App: gsd-pi
// File Purpose: Detect and apply connected transcript rails between chat turns.

import { Spacer } from "@gsd/pi-tui";
import { AssistantMessageComponent } from "./assistant-message.js";
import { ToolExecutionComponent, ToolPhaseSummaryComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

type ChatTurnComponent = UserMessageComponent | AssistantMessageComponent;
type UserTurnConnection = { continuesToAssistant: boolean };
type AssistantTurnConnection = { continuesToUser: boolean; connectedToUser: boolean };

function isChatTurnComponent(child: unknown): child is ChatTurnComponent {
	return child instanceof UserMessageComponent || child instanceof AssistantMessageComponent;
}

export function chatTurnFollowsUser(children: readonly unknown[]): boolean {
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i];
		if (child instanceof Spacer) continue;
		if (child instanceof ToolExecutionComponent || child instanceof ToolPhaseSummaryComponent) continue;
		return child instanceof UserMessageComponent;
	}
	return false;
}

/** Recompute connected-rail flags for every user/assistant turn in the chat container. */
export function reconcileChatTurnConnections(children: readonly unknown[]): void {
	const userConnections = new Map<UserMessageComponent, UserTurnConnection>();
	const assistantConnections = new Map<AssistantMessageComponent, AssistantTurnConnection>();

	let previousTurn: ChatTurnComponent | undefined;
	for (const child of children) {
		if (child instanceof Spacer) continue;
		if (child instanceof ToolExecutionComponent || child instanceof ToolPhaseSummaryComponent) continue;
		if (!isChatTurnComponent(child)) {
			previousTurn = undefined;
			continue;
		}

		if (child instanceof UserMessageComponent) {
			userConnections.set(child, { continuesToAssistant: false });
		} else {
			assistantConnections.set(child, { continuesToUser: false, connectedToUser: false });
		}

		if (previousTurn instanceof UserMessageComponent && child instanceof AssistantMessageComponent) {
			userConnections.get(previousTurn)!.continuesToAssistant = true;
			assistantConnections.get(child)!.connectedToUser = true;
		} else if (previousTurn instanceof AssistantMessageComponent && child instanceof UserMessageComponent) {
			assistantConnections.get(previousTurn)!.continuesToUser = true;
		}

		previousTurn = child;
	}

	for (const [child, connection] of userConnections) {
		child.setContinuesToAssistant(connection.continuesToAssistant);
	}
	for (const [child, connection] of assistantConnections) {
		child.setContinuesToUser(connection.continuesToUser);
		child.setConnectedToUser(connection.connectedToUser);
	}
}
