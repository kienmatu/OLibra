<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Support\AuditRecorder;
use App\Support\TenantContext;

/**
 * The fluent configurator of spec 3b-i D0. WideningArchitectureTest pins
 * WHERE it may be called from; this file pins WHAT it does, and — the point
 * of the whole shape — that the unconfigured recorder every shelf-scoped
 * command receives is exactly as fail-closed as it was before.
 *
 * These call `->global()` and `->forShelf()` from tests/, which the
 * architecture fence does not scan (its roots are app/, database/, routes/).
 */
it('writes a null bookshelf_id for a global administration act', function () {
    app(TenantContext::class)->clear();

    app(AuditRecorder::class)->global()->record(
        'test.global_probe', 'user', null, null, ['promoted' => true],
    );

    $row = AuditLog::query()->sole();
    expect($row->bookshelf_id)->toBeNull()
        ->and($row->action)->toBe('test.global_probe');
});

it('writes the named shelf when no tenant is bound', function () {
    $shelf = Bookshelf::query()->create([
        'slug' => 'dong-thap', 'name' => 'Tủ sách Đồng Tháp', 'settings' => [],
    ]);
    app(TenantContext::class)->clear();

    app(AuditRecorder::class)->forShelf($shelf->id)->record(
        'test.shelf_probe', 'bookshelf', $shelf->id, null, ['name' => $shelf->name],
    );

    expect(AuditLog::query()->sole()->bookshelf_id)->toBe($shelf->id);
});

it('still throws for an unconfigured recorder with no bound tenant', function () {
    app(TenantContext::class)->clear();

    app(AuditRecorder::class)->record('test.unconfigured', 'user', null, null, null);
})->throws(RuntimeException::class, 'AuditRecorder needs a bound tenant');

/**
 * Configuring returns a COPY. If it mutated the recorder in place, the
 * container's scoped singleton would stay configured for the rest of the
 * request and the next shelf-scoped command in the same request would
 * silently write a null bookshelf_id instead of throwing.
 */
it('leaves the shared recorder unconfigured', function () {
    app(TenantContext::class)->clear();
    $recorder = app(AuditRecorder::class);

    $recorder->global();

    expect(fn () => $recorder->record('test.after_configure', 'user', null, null, null))
        ->toThrow(RuntimeException::class);
});
