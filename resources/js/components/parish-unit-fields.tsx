import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

export interface ParishTaxonomyProp {
    levels: number;
    nested: boolean;
    level1Label: string;
    level2Label: string;
}

export interface ParishUnitProp {
    id: string;
    level: number;
    parentId: string | null;
    name: string;
}

interface Props {
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
    l1: string;
    l2: string;
    onChange: (l1: string, l2: string) => void;
}

/**
 * BR §16.1's "zero, one or two pickers depending on what the shelf has
 * configured, each labelled with that shelf's own name for the level" —
 * never the words Tổ or Giáo họ written into the screen. A level with no
 * live units renders no field (no empty select offering only "không
 * chọn"). When nested, the level-2 options follow the chosen parent and
 * a parent change clears a child that no longer belongs.
 */
export default function ParishUnitFields({ taxonomy, units, l1, l2, onChange }: Props) {
    const level1 = units.filter((u) => u.level === 1);
    const level2All = units.filter((u) => u.level === 2);
    const level2 = taxonomy.nested ? level2All.filter((u) => u.parentId === l1) : level2All;
    const showLevel2 = taxonomy.levels === 2 && level2All.length > 0;

    if (level1.length === 0 && !showLevel2) return null;

    const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]";

    return (
        <div className="space-y-6">
            {level1.length > 0 && (
                <div className="space-y-2">
                    <Label htmlFor="parish-l1">{taxonomy.level1Label}</Label>
                    <select
                        id="parish-l1"
                        name="parish_unit_l1_id"
                        className={selectClass}
                        value={l1}
                        onChange={(e) => {
                            const next = e.target.value;
                            const keepChild =
                                !taxonomy.nested ||
                                level2All.some((u) => u.parentId === next && u.id === l2);
                            onChange(next, keepChild ? l2 : "");
                        }}
                    >
                        <option value="">{copy.register.noUnit}</option>
                        {level1.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            {showLevel2 && (
                <div className="space-y-2">
                    <Label htmlFor="parish-l2">{taxonomy.level2Label}</Label>
                    <select
                        id="parish-l2"
                        name="parish_unit_l2_id"
                        className={selectClass}
                        value={l2}
                        onChange={(e) => onChange(l1, e.target.value)}
                    >
                        <option value="">{copy.register.noUnit}</option>
                        {level2.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}
