type VolunteerActionState = {
  statoApprovazione: string;
  sospesoManualmente: boolean;
  abilitatoAmministrativamente: boolean;
};

export function canSuspendVolunteer(volunteer: VolunteerActionState): boolean {
  return (
    volunteer.statoApprovazione === "approvato" &&
    volunteer.abilitatoAmministrativamente &&
    !volunteer.sospesoManualmente
  );
}

export function canReactivateVolunteer(
  volunteer: VolunteerActionState,
): boolean {
  return (
    volunteer.statoApprovazione === "approvato" && volunteer.sospesoManualmente
  );
}
