import { ChevronRight, UserRound } from "lucide-react";
// Relative, not the `@/` alias: this file is exercised by
// `tests/components/contact-list.test.tsx`, and `vitest.config.ts` has no
// `resolve.alias` for `@/` — the same note `phone-link.tsx` and
// `public-header.tsx` carry for the identical reason. An alias import here
// would make the component unimportable under Vitest, not just untested.
import type { ShelfContact } from "../../domain/shelf/queries/get-shelf-settings";
import { PhoneLink } from "./phone-link";

/**
 * A shelf's contacts, as a reader sees them.
 *
 * Contact 1 is always visible; the rest sit behind a `<details>` summary.
 * `<details>`/`<summary>` rather than a client component with state, because
 * every page rendering this is a server component with no JavaScript —
 * `MobileMenu` in `shell/public-header.tsx` is built the same way for the
 * same reason.
 *
 * Empty renders nothing. A shelf onboarded before anyone filled in a
 * volunteer has no contacts, and a panel headed "Người liên hệ" over the word
 * "Chưa có" is a row of chrome telling a reader they cannot be helped — the
 * shelf home's own rule that every row is conditional on the column behind it.
 *
 * `UserRound` and `ChevronRight`, from `lucide-react`, outline style. Neither
 * is one of `src/lib/status.ts`'s six copy-state icons (`BookOpen`,
 * `BookMarked`, `Bookmark`, `AlertTriangle`, `HelpCircle`, `Archive`) — an
 * icon that means a copy's status elsewhere in this app must not also mean
 * "a person" here, the same argument `public-header.tsx` makes for why its
 * home link is a plain `Book` rather than `BookOpen`/`BookMarked`.
 */
export function ContactList({ contacts }: { contacts: readonly ShelfContact[] }) {
  if (contacts.length === 0) return null;
  const [first, ...rest] = [...contacts].sort((a, b) => a.position - b.position);

  return (
    <div>
      <ContactRow contact={first} />
      {rest.length > 0 ? (
        <details className="mt-3 [&_svg]:open:rotate-90">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] text-leather [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-5 transition-transform duration-150"
              strokeWidth={1.75}
            />
            Xem thêm {rest.length} người liên hệ
          </summary>
          <div className="mt-3 space-y-4 border-t border-hairline pt-3">
            {rest.map((contact) => (
              <ContactRow key={contact.position} contact={contact} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: ShelfContact }) {
  return (
    <div className="flex gap-3">
      <UserRound
        aria-hidden
        className="mt-1 size-5 shrink-0 text-leather"
        strokeWidth={1.75}
      />
      <div>
        <p className="text-[14px] text-meta">
          {contact.roleLabel ?? "Người liên hệ"}
        </p>
        <p className="text-[16px]">{contact.name}</p>
        {contact.phone ? (
          <p className="mt-0.5">
            <PhoneLink phone={contact.phone} size="md" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
