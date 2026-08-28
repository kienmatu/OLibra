<?php

use App\Support\Catalogue\Slugs;
use App\Support\Fold;

it('every fixture title\'s slug is its folded title with hyphens', function () {
    $titles = [
        'Dế Mèn Phiêu Lưu Ký' => 'de-men-phieu-luu-ky',
        'Hoàng Tử Bé' => 'hoang-tu-be',
        'Totto-chan Bên Cửa Sổ' => 'totto-chan-ben-cua-so',
        'Đất Rừng Phương Nam' => 'dat-rung-phuong-nam',
        'Tuổi Thơ Dữ Dội' => 'tuoi-tho-du-doi',
    ];
    foreach ($titles as $title => $slug) {
        expect(Slugs::fromTitle($title))->toBe($slug);
    }
});

it('is fold with hyphens — the derivation cannot drift from search', function () {
    $title = 'Kính Vạn Hoa';
    expect(Slugs::fromTitle($title))->toBe(str_replace(' ', '-', Fold::fold($title)));
});

it('đ folds to d in a slug, not just in search', function () {
    expect(Slugs::fromTitle('Đường'))->toBe('duong');
});

it('a title that folds to nothing still yields a routable slug', function () {
    expect(Slugs::fromTitle('!!!'))->toBe('sach');
});

it('CRITICAL 1: disambiguates a taken base rather than rejecting the title', function () {
    expect(Slugs::nextAvailable('de-men', []))->toBe('de-men')
        ->and(Slugs::nextAvailable('de-men', ['de-men']))->toBe('de-men-2')
        ->and(Slugs::nextAvailable('de-men', ['de-men', 'de-men-2', 'de-men-3']))->toBe('de-men-4')
        // a gap is reused — the sequence scans, it does not max()+1
        ->and(Slugs::nextAvailable('de-men', ['de-men', 'de-men-3']))->toBe('de-men-2');
});
