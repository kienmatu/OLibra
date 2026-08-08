"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  unitOptions,
  type ParishTaxonomy,
  type ParishUnit,
} from "@/domain/members/parish-taxonomy";

/**
 * The unit-management half of the *Phân chia giáo xứ* settings section
 * (`/quan-tri/tu-sach`) — everything below the level-count / labels /
 * nesting fields, which stay plain server-rendered markup because they have
 * no list to reorder.
 *
 * Client-side, local-state only, matching how this settings screen has no
 * working submit anywhere else yet ("Lưu cài đặt" does not post). What this
 * component demonstrates has to be real regardless: `CreateParishUnit` is
 * specified to take an explicit `sortOrder` (OPERATIONS.md), and
 * `ReorderParishUnits` exists specifically because §7 treats "Tổ 10" sorting
 * before "Tổ 2" as a real defect, not a nitpick — so the two UI affordances
 * that produce and change `sortOrder` need to actually produce and change
 * it, not just be buttons that happen to sit near a list.
 */
export function ParishUnitsEditor({
  taxonomy,
  initialUnits,
}: {
  taxonomy: ParishTaxonomy;
  initialUnits: ParishUnit[];
}) {
  const [units, setUnits] = useState(initialUnits);
  const level1Units = unitOptions(units, 1);

  /** One past the highest `sortOrder` already in use at this level/parent —
   *  appending at the end of its own scope, never 0 (IMPORTANT 7). */
  function nextSortOrder(level: 1 | 2, parentId: string | null): number {
    const scoped = unitOptions(units, level, level === 2 ? parentId : undefined);
    return scoped.length === 0
      ? 1
      : Math.max(...scoped.map((u) => u.sortOrder)) + 1;
  }

  function addUnit(level: 1 | 2, parentId: string | null, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUnits((prev) => [
      ...prev,
      {
        id: `new-${crypto.randomUUID()}`,
        level,
        parentId,
        name: trimmed,
        sortOrder: nextSortOrder(level, parentId),
        deletedAt: null,
      },
    ]);
  }

  /** Swaps `sortOrder` with the immediate neighbour in the same scope
   *  (level, and parent when nested) — `ReorderParishUnits`' effect, one
   *  step at a time. A no-op at either end of the list. */
  function move(unitId: string, direction: -1 | 1) {
    setUnits((prev) => {
      const unit = prev.find((u) => u.id === unitId);
      if (!unit) return prev;
      const scoped = unitOptions(
        prev,
        unit.level,
        unit.level === 2 ? unit.parentId : undefined,
      );
      const index = scoped.findIndex((u) => u.id === unitId);
      const swapIndex = index + direction;
      if (swapIndex < 0 || swapIndex >= scoped.length) return prev;
      const other = scoped[swapIndex];
      return prev.map((u) => {
        if (u.id === unit.id) return { ...u, sortOrder: other.sortOrder };
        if (u.id === other.id) return { ...u, sortOrder: unit.sortOrder };
        return u;
      });
    });
  }

  /** Soft-deletes a unit. Deleting a level-1 unit cascades to its live
   *  level-2 children in the same update — design §7's decision, made
   *  concrete: a tổ inside a deleted giáo họ is not a place anyone belongs. */
  function deleteUnit(unitId: string) {
    setUnits((prev) => {
      const target = prev.find((u) => u.id === unitId);
      if (!target) return prev;
      const cascaded = new Set([unitId]);
      if (target.level === 1) {
        for (const u of prev) {
          if (u.level === 2 && u.parentId === unitId) cascaded.add(u.id);
        }
      }
      const now = new Date().toISOString();
      return prev.map((u) => (cascaded.has(u.id) ? { ...u, deletedAt: now } : u));
    });
  }

  return (
    <>
      <div className="space-y-3 border-t border-hairline pt-6">
        <p className="text-[16px] font-medium">
          Danh sách {taxonomy.level1Label.toLowerCase()}
        </p>
        <UnitList units={level1Units} onMove={move} onDelete={deleteUnit} />
        <AddUnitRow
          placeholder={`${taxonomy.level1Label} mới`}
          onAdd={(name) => addUnit(1, null, name)}
        />
      </div>

      {taxonomy.levels === 2 ? (
        <div className="space-y-3 border-t border-hairline pt-6">
          <p className="text-[16px] font-medium">
            Danh sách {taxonomy.level2Label.toLowerCase()}
          </p>

          {taxonomy.nested ? (
            <div className="space-y-5">
              {level1Units.map((parent) => (
                <div key={parent.id}>
                  <p className="text-[14px] text-meta">
                    Trong {parent.name.toLowerCase()}
                  </p>
                  <UnitList
                    className="mt-2"
                    units={unitOptions(units, 2, parent.id)}
                    onMove={move}
                    onDelete={deleteUnit}
                  />
                  <AddUnitRow
                    placeholder={`${taxonomy.level2Label} mới trong ${parent.name}`}
                    onAdd={(name) => addUnit(2, parent.id, name)}
                  />
                </div>
              ))}
              {level1Units.length === 0 ? (
                <p className="text-[14px] text-meta">
                  Thêm {taxonomy.level1Label.toLowerCase()} trước đã, vì{" "}
                  {taxonomy.level2Label.toLowerCase()} ở đây nằm trong đó.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <UnitList
                units={unitOptions(units, 2)}
                onMove={move}
                onDelete={deleteUnit}
              />
              <AddUnitRow
                placeholder={`${taxonomy.level2Label} mới`}
                onAdd={(name) => addUnit(2, null, name)}
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function UnitList({
  units,
  onMove,
  onDelete,
  className,
}: {
  units: ParishUnit[];
  onMove: (unitId: string, direction: -1 | 1) => void;
  onDelete: (unitId: string) => void;
  className?: string;
}) {
  if (units.length === 0) return null;
  return (
    <ul className={className ? `space-y-2 ${className}` : "space-y-2"}>
      {units.map((unit, index) => (
        <UnitRow
          key={unit.id}
          unit={unit}
          canMoveUp={index > 0}
          canMoveDown={index < units.length - 1}
          onMoveUp={() => onMove(unit.id, -1)}
          onMoveDown={() => onMove(unit.id, 1)}
          onDelete={() => onDelete(unit.id)}
        />
      ))}
    </ul>
  );
}

/** One unit in a management list — reorder handles, its name, then
 *  rename/remove actions. */
function UnitRow({
  unit,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  unit: ParishUnit;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Đưa ${unit.name} lên trên`}
            disabled={!canMoveUp}
            onClick={onMoveUp}
            className="flex size-9 items-center justify-center rounded text-meta hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronUp aria-hidden className="size-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label={`Đưa ${unit.name} xuống dưới`}
            disabled={!canMoveDown}
            onClick={onMoveDown}
            className="flex size-9 items-center justify-center rounded text-meta hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronDown aria-hidden className="size-4" strokeWidth={2} />
          </button>
        </div>
        <span className="text-[15px]">{unit.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="quiet" size="sm">
          Đổi tên
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={onDelete}>
          Xoá
        </Button>
      </div>
    </li>
  );
}

/** The "add one more" row at the foot of every unit list. */
function AddUnitRow({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (name: string) => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");

  function submit() {
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Input
        id={inputId}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="h-11 max-w-64"
      />
      <Button type="button" variant="outline" size="sm" onClick={submit}>
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        Thêm
      </Button>
    </div>
  );
}
