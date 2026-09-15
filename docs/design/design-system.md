> **Superseded in appearance by ADR-026 (the Holographic HUD).**
>
> The scales, roles and rules below still hold — spacing, radius,
> typography steps, the five semantic colour roles, and the requirement
> that components reference tokens rather than literals. What changed is
> every *value*, plus three additions the HUD needs: a signal colour, a
> glow set, and named motion durations. `app/tokens.css` is the source of
> truth for values; ADR-026 is the source of truth for why they are what
> they are.

# Design System

## Design goal

Calm, information-dense, highly readable household operations UI. The interface should feel like a trusted control room, not a productivity game.

## Visual language

- neutral surfaces
- strong typographic hierarchy
- restrained semantic colors
- generous whitespace around primary actions
- dense secondary metadata
- no decorative gradients
- no excessive shadows
- consistent 8px spacing grid
- rounded corners used sparingly
- strong focus states

## Tokens

Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48.

Radius: 6, 10, 14.

Typography:
- display 28/34
- h1 24/30
- h2 20/26
- h3 16/22
- body 14/20
- compact 12/16

Semantic colors:
- critical: red
- warning: amber
- success: green
- info: blue
- neutral: slate

Do not rely on color alone; use icons/labels.

## Core components

AppShell
Sidebar
MobileBottomNav
TopBar
Breadcrumbs
CommandPalette
SearchInput
Button
IconButton
Badge
StatusBadge
PriorityBadge
Avatar
PersonChip
EntityLink
Card
List
DataTable
Timeline
Tabs
FilterBar
DatePicker
DateRangePicker
Combobox
Dialog
Drawer
Toast
EmptyState
Skeleton
ErrorState
ConfirmDialog
FormField
TextArea
RichText-lite
Checkbox
Switch
Progress
Calendar
Kanban
AttentionItem
NextAction
ActivityItem
DocumentReference
Money
AuditTrail
PermissionGate (visual only; never authorization)
