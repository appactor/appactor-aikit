/**
 * The one rule the preview -> apply delete tools exist to enforce, and the sentences built from it.
 *
 * Every delete tool (projects, apps, Apple Ads campaigns and ad groups) and the server instructions
 * compose from this module. The rule has to reach the model in three places — the tool descriptions,
 * the server instructions, and the reminder attached to every preview result — and when those were
 * hand-written strings they had already drifted after a single round of edits, with the runtime one
 * (the copy the model reads at the exact moment it decides) ending up the weakest of the three.
 */
export const DELETE_CONFIRMATION_RULE =
	'Call action "apply" only in a LATER turn, with confirmName set to the name the user typed in a new message of their own. The name they used when asking for the deletion does not count, nor does any name already in this conversation, nor the one in the preview. If there is no interactive user — an unattended or automated run — do not call apply at all; say deletion needs a person and stop.'

export const DELETE_PROTOCOL = `Two steps. First call action "preview" for the blast radius and a previewToken that expires in five minutes. Show it and END YOUR TURN. ${DELETE_CONFIRMATION_RULE} This cannot be undone.`

const DELETE_STOP_REMINDER = `STOP HERE. End your turn with this text and wait. ${DELETE_CONFIRMATION_RULE}`

export function countLabel(value: { count: number; atLeast: boolean }) {
	return value.atLeast ? `${value.count}+` : `${value.count}`
}

/**
 * The preview half: the sentence the user is asked to approve, then the stop. Deliberately spelled
 * out by each caller rather than summarised here: the confirmation the user has to type is the name,
 * not a yes, so the sentence must say exactly what goes.
 */
export function deletePreviewSummary(destruction: string) {
	return `${destruction} This cannot be undone.\n\n${DELETE_STOP_REMINDER}`
}

/** The apply half. `label` names the target as the user knows it: "project", "Apple Ads campaign". */
export function deleteOutcomeSummary(
	label: string,
	outcome: { name: string; alreadyAbsent: boolean },
	replayed: boolean,
) {
	if (outcome.alreadyAbsent)
		return `The ${label} "${outcome.name}" was already deleted; nothing to do.`
	return `${label} "${outcome.name}" deleted${replayed ? ' (replayed)' : ''}.`
}
