/**
 * "Office not recognized" message — rendered inside the host view's own layout
 * shell (phone frame in PatientView, lf-empty block in DeskView).
 *
 * `verbose` adds an explanatory paragraph suitable for staff who can act on
 * it (e.g. re-provision the NFC tag).  Patients see only the short heading
 * because they cannot resolve the issue themselves.
 */
interface Props {
  verbose?: boolean;
}

export function OfficeNotFound({ verbose = false }: Props) {
  return (
    <>
      <p className="lf-empty-title">Office not recognized</p>
      {verbose && (
        <p className="lf-empty-body">
          The URL contains an unrecognized office ID. Check that the NFC tag or
          link is current and points to a provisioned office.
        </p>
      )}
    </>
  );
}
