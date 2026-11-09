# Shared ticket nicknames

Command Centre staff can set one shared nickname for any ticket. The nickname is local to Command Centre; the MSP Central subject and outgoing calendar/helpdesk writes keep their existing titles.

Store nicknames by MSP Central request ID in a dedicated server-only table, independent of schedules and Tracks. An approved staff member can set, edit, or clear a nickname. Limit the normalized nickname to 80 characters and record who last changed it.

The ticket workspace provides an inline edit control. The request queue shows the nickname prominently while retaining the original subject beneath it. Both the global and queue search find nicknames. Dashboard refreshes load the stored nicknames for all currently visible requests, and a successful save updates the current screen immediately.

If persistence fails, leave the previous nickname on screen and show an error in the workspace. Clearing a nickname restores the original subject as the main title.
