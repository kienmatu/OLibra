import InputError from "@/components/input-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface PersonFieldValues {
    saint_name: string;
    full_name: string;
    date_of_birth: string;
    father_name: string;
    mother_name: string;
    phone: string;
    phone_missing_reason: string;
    email: string;
}

interface Props {
    data: PersonFieldValues;
    errors: Partial<Record<keyof PersonFieldValues, string>>;
    showPhoneReason: boolean;
    setField: (field: keyof PersonFieldValues, value: string) => void;
}

const PHONE_PATTERN = "[+0-9][0-9 .-]{7,13}";

function FieldBlock({
    id,
    label,
    hint,
    required,
    error,
    children,
}: {
    id: string;
    label: string;
    hint?: string;
    required?: boolean;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>
                {label}
                {required ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {copy.register.required}
                    </span>
                ) : null}
            </Label>
            {children}
            {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
            <InputError message={error} />
        </div>
    );
}

/** The Bản thân / Gia đình groups both registration forms share (BR §16.1). */
export default function RegistrationPersonFields({
    data,
    errors,
    showPhoneReason,
    setField,
}: Props) {
    return (
        <>
            <section className="space-y-6">
                <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupPerson}</h2>
                <FieldBlock
                    id="saint_name"
                    label={copy.register.saintName}
                    hint={copy.register.saintNameHint}
                    required
                    error={errors.saint_name}
                >
                    <Input
                        id="saint_name"
                        value={data.saint_name}
                        onChange={(e) => setField("saint_name", e.target.value)}
                    />
                </FieldBlock>
                <FieldBlock
                    id="full_name"
                    label={copy.register.fullName}
                    hint={copy.register.fullNameHint}
                    required
                    error={errors.full_name}
                >
                    <Input
                        id="full_name"
                        value={data.full_name}
                        onChange={(e) => setField("full_name", e.target.value)}
                    />
                </FieldBlock>
                <FieldBlock
                    id="date_of_birth"
                    label={copy.register.dateOfBirth}
                    hint={copy.register.dateOfBirthHint}
                    required
                    error={errors.date_of_birth}
                >
                    <Input
                        id="date_of_birth"
                        type="date"
                        value={data.date_of_birth}
                        onChange={(e) => setField("date_of_birth", e.target.value)}
                    />
                </FieldBlock>
            </section>

            <section className="space-y-6">
                <h2 className="border-b pb-3 text-xl font-semibold">{copy.register.groupFamily}</h2>
                <FieldBlock
                    id="father_name"
                    label={copy.register.fatherName}
                    hint={copy.register.parentHint}
                    required
                    error={errors.father_name}
                >
                    <Input
                        id="father_name"
                        value={data.father_name}
                        onChange={(e) => setField("father_name", e.target.value)}
                    />
                </FieldBlock>
                <FieldBlock
                    id="mother_name"
                    label={copy.register.motherName}
                    hint={copy.register.parentHint}
                    required
                    error={errors.mother_name}
                >
                    <Input
                        id="mother_name"
                        value={data.mother_name}
                        onChange={(e) => setField("mother_name", e.target.value)}
                    />
                </FieldBlock>
                <FieldBlock
                    id="phone"
                    label={copy.register.phone}
                    hint={copy.register.phoneHint}
                    required
                    error={errors.phone}
                >
                    <Input
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        pattern={PHONE_PATTERN}
                        value={data.phone}
                        onChange={(e) => setField("phone", e.target.value)}
                    />
                </FieldBlock>
                {showPhoneReason ? (
                    <FieldBlock
                        id="phone_missing_reason"
                        label={copy.register.phoneMissingReason}
                        hint={copy.register.phoneMissingHint}
                        required
                        error={errors.phone_missing_reason}
                    >
                        <textarea
                            id="phone_missing_reason"
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
                            value={data.phone_missing_reason}
                            onChange={(e) => setField("phone_missing_reason", e.target.value)}
                        />
                    </FieldBlock>
                ) : null}
            </section>
        </>
    );
}
