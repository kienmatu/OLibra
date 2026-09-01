import { ImageOff } from "lucide-react";
import { copy } from "@/lib/copy";

/**
 * One photograph with its caption underneath.
 *
 * LIFTED OUT OF resources/js/pages/shelves/profile/index.tsx, where it was
 * written for that page's three uses (the picture in force, the picture
 * waiting, and the one in the upload section) and where it stayed while the
 * two DECISION queues rendered a sentence instead — "Bạn đọc có gửi kèm ảnh
 * đại diện mới." That sentence was the defect: a manager approved a
 * photograph of a child on the strength of a claim that one existed. Both
 * queues now show the pair, and AGENTS.md's own rule about pages growing
 * their own copies of a shared shape is why they show it through this file
 * rather than through three near-identical figures.
 *
 * NEVER A BARE CIRCLE. Somebody with no photograph reads *Chưa có ảnh*
 * rather than being shown a grey disc to interpret — the same rule the
 * profile page's ValueRow follows for an unset text value (AGENTS.md rule
 * 6's "never an empty cell"), and it matters more here: on a decision card,
 * an unexplained empty square beside a real photograph reads as "the
 * proposal is blank" rather than "this reader had none before".
 *
 * The square is 1px-hairline-bordered and flat — no shadow, no gradient
 * (rule 7) — and `object-cover` is belt-and-braces: every stored avatar is
 * already a 512×512 square, because App\Support\Members\AvatarImage
 * centre-crops it, so this only matters for the moment a disk is serving
 * something older.
 *
 * THE "no photograph" WORDS COME FROM `copy.myProfile.avatarNone` rather
 * than from a key of this component's own. There is one Vietnamese sentence
 * for this state and a second copy of it under a second key is how the two
 * drift apart; the reader's page is where it was first written and where it
 * still reads most naturally.
 */
export default function AvatarFigure({
    label,
    url,
    size = "size-24",
}: {
    label: string;
    url: string | null;
    size?: string;
}) {
    const c = copy.myProfile;

    return (
        <figure className="shrink-0">
            {url ? (
                <img src={url} alt={label} className={`${size} rounded-md border object-cover`} />
            ) : (
                <div
                    className={`${size} flex items-center justify-center rounded-md border bg-muted`}
                >
                    <ImageOff aria-hidden className="size-6 text-muted-foreground" />
                </div>
            )}
            <figcaption className="mt-1 text-xs text-muted-foreground">
                {url ? label : `${label} · ${c.avatarNone}`}
            </figcaption>
        </figure>
    );
}
