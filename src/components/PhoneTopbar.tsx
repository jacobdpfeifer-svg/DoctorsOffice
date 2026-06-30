interface Props {
  office: string;
}

export function PhoneTopbar({ office }: Props) {
  return (
    <div className="lf-ptop">
      <span className="lf-ptop-dot" />
      <span className="lf-ptop-name">{office}</span>
    </div>
  );
}
