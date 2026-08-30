<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

/**
 * A business-rule refusal with a stable, machine-readable code (OPS §2:
 * "Errors are named, not generic"). The code doubles as the lang/vi/rules.php
 * key; the render hook in bootstrap/app.php is the one place a code becomes
 * a sentence, so a rule refused in an Action and a rule refused in a later
 * phase's console command read identically.
 *
 * Deviation from the brief: `public readonly string $code` as a promoted
 * constructor property is impossible here, not a style choice. Every
 * Exception subclass inherits PHP's own untyped, non-readonly `$code`
 * property (the one behind getCode()). Redeclaring it `readonly` fatals with
 * "Cannot redeclare non-readonly property as readonly"; redeclaring it with
 * a `string` type then fatals with "Type of ...::$code must not be defined
 * (as in class Exception)" — PHP forbids typing a property the parent left
 * untyped. Both reproduced live against RuleViolatedRenderingTest before
 * landing on this shape. `$code` stays untyped and public, exactly mirroring
 * the parent's own declaration, and is set once, in the constructor, and
 * never reassigned anywhere in this codebase — a business-rule code, not
 * Exception's numeric one, but readonly in practice if not in the engine.
 *
 * `$previous` is optional and every throw site under app/Actions omits it,
 * because a rule refused by a command has no underlying cause worth
 * carrying — the code IS the cause. The one caller that passes it is
 * App\Support\ConcurrencyRetry, which is not a command but a TRANSLATION
 * of a driver exception, and dropping the chain there loses the SQL and the
 * throwing Action's frames both: an exception captures its trace where it
 * is CONSTRUCTED, which for a mapped translation is inside the exception
 * handler rather than inside the command. Monolog's LineFormatter walks the
 * previous chain, so passing it is what keeps an exhausted deadlock
 * diagnosable as to command as well as to statement.
 */
final class RuleViolated extends RuntimeException
{
    /** @var string */
    public $code;

    public function __construct(string $code, ?Throwable $previous = null)
    {
        parent::__construct($code, 0, $previous);

        $this->code = $code;
    }
}
