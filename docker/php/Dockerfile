FROM dunglas/frankenphp:1-php8.4

# `exif` is Phase 3c-i Task 8's addition, and it is not optional here.
# docs/HOSTING.md row 3 came back on 2026-09-01 with `exif` PRESENT on the
# real cPanel host and `imagick` ABSENT — so the avatar pipeline runs on the
# `gd` driver and EXIF-rotates through exif_read_data(). This image and both
# CI workflows installed `gd` without `exif`, which is the shape where the
# code works in production and fails everywhere it is tested.
RUN install-php-extensions pdo_mysql intl zip bcmath gd exif opcache pcntl

RUN echo "memory_limit = 512M" > /usr/local/etc/php/conf.d/99-memory-limit.ini

# The avatar upload's byte cap is 5 MiB (App\Support\Members\AvatarLimits),
# and PHP's stock upload_max_filesize of 2M would refuse a 3 MiB photograph
# from any phone made in the last decade before a single line of application
# code ran — with PHP's own empty-$_FILES failure rather than the Vietnamese
# sentence `file_too_large` carries. Both numbers sit ABOVE the cap on
# purpose, so that everything between 5 MiB and 8 MiB is refused by the
# application, in Vietnamese, and only something absurd is refused by PHP.
RUN printf 'upload_max_filesize = 8M\npost_max_size = 10M\n' \
    > /usr/local/etc/php/conf.d/99-uploads.ini

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

ENV SERVER_NAME=:80
