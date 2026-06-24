---
name: shadcn FormLabel crashes outside FormField
description: Using FormLabel (or any shadcn Form* primitive) outside a FormField/FormItem throws and blanks the whole app.
---

# shadcn FormLabel must live inside FormField/FormItem

`FormLabel`, `FormControl`, `FormMessage` etc. all call `useFormField()`, which
**throws** ("useFormField should be used within <FormField>/<FormItem>") when there
is no surrounding `<FormField>` + `<FormItem>` context.

**Why it's dangerous here:** the app has NO React error boundary, so any such throw
during render blanks the entire SPA (white frozen page), not just the offending
section. Symptom seen: clicking "Modifica" on a product opened an edit sheet whose
lots sub-list used a bare `<FormLabel>` for a section heading → whole app went white.

**How to apply:** for plain section headings/labels that are NOT bound to a form
field, use the plain `Label` from `@/components/ui/label` (or a styled element),
never `FormLabel`. Reserve `FormLabel` for inside a `<FormField render={() =>
<FormItem>...}>`. Consider this first whenever a dialog/sheet renders a blank page.
