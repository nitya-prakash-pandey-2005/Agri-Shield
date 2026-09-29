/**
 * Collaboration kit — embed anywhere in the workspace:
 *
 *   <Comments entityType="asset" entityId={asset.id} />   threaded comments + @mentions
 *   <PresenceAvatars room={`asset:${asset.id}`} />          who is viewing right now
 *   <Avatar user={{ name, initials, color }} />
 *
 * Server side lives in server/services/collab.ts; procedures under trpc.incidents.collab.*
 */
export { Comments, CommentBody } from "./Comments";
export { PresenceAvatars, usePresence } from "./PresenceAvatars";
export { Avatar, AvatarStack, type AvatarUser } from "./Avatar";
export { groupByDay, relTime, splitMentions } from "./shared";
export { useRoomEvents } from "./useRoomEvents";
