# Command Centre Logo Brand Refresh Design

## Context

The supplied Command Centre logo pack defines a deep navy operational identity with vivid orange, urgent red, white route-line geometry, and a dimensional app icon. The current technician app already uses a dark operational shell, but its primary accent is cyan and the native icon/splash are not wired to the brand assets.

## Chosen Direction

Use a balanced operational refresh. The app should feel like Command Centre without becoming visually loud: navy remains the workspace, orange becomes the primary action and selected-navigation colour, and red remains reserved for urgency or destructive states.

Rejected alternatives:

- Bold branded: stronger gradients and orange/red-heavy surfaces. This would compete with field-work readability.
- Minimal refresh: only swap the app icon and a few accents. This would leave the sign-in and navigation feeling disconnected from the logo.

## Requirements

- Use real logo assets from `/Users/simeon/Desktop/egit-app-logos 5/final/command-centre/`.
- Keep the existing technician workflows, tabs, route names, and authentication behaviour unchanged.
- Replace cyan as the primary UI accent with logo orange `#FF823A`.
- Keep red `#F21F31` semantic for urgency, critical, or destructive states.
- Use logo navy `#071526` as the app canvas.
- Show a brand mark on the sign-in screen using a real raster asset.
- Configure Expo icon and Android adaptive icon to use the supplied app icon.
- Do not add a splash-screen dependency; this app does not currently install one and this refresh stays dependency-neutral.
- Do not add new dependencies for gradients or SVG rendering.

## Screen Design

The sign-in screen becomes the main brand moment. It shows the app icon above the Command Centre wordmark text, uses a compact segmented orange/red accent line, and presents the Zoho sign-in as a warm orange primary action. Copy remains short and operational.

The tab shell keeps the existing native navigator and MaterialCommunityIcons. Active tabs switch from cyan to orange, while inactive labels remain muted for scanability.

## Testing

Add focused tests around the brand contract: theme tokens expose the logo palette, the sign-in route renders an accessible brand image, and the tab navigator uses the warm accent for active navigation. Existing navigation tests must still pass.
