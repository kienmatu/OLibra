<?php

/**
 * The three CSVs' headers and enum words — server copy (a spreadsheet
 * column is a name for the same fact a screen labels). Words are
 * copy.ts's shipped ones verbatim where a screen already says them
 * (status, condition, membership status — ExportQueriesTest pins the
 * status/condition sets against copy.ts source text, the FoldParityTest
 * pattern); "Đã trả" and "Đã huỷ" are the reference's exports.ts words
 * for the two loan states no screen lists.
 */
return [
    'books_headers' => ['Tên sách', 'Tác giả', 'Thể loại', 'Nhà xuất bản', 'Năm xuất bản',
        'ISBN', 'Số trang', 'Đang hiển thị', 'Mã bản sách', 'Tình trạng bản sách',
        'Chất lượng', 'Ngày nhập', 'Nguồn'],
    'readers_headers' => ['Tên thánh', 'Họ và tên', 'Ngày sinh', 'Tên cha', 'Tên mẹ',
        'Số điện thoại', 'Email', 'Đơn vị', 'Trạng thái', 'Vai trò',
        'Có tài khoản đăng nhập', 'Ngày tham gia'],
    'loans_headers' => ['Tên sách', 'Mã bản sách', 'Người mượn', 'Ngày mượn', 'Hạn trả',
        'Ngày trả', 'Trạng thái', 'Chất lượng khi trả', 'Người cho mượn',
        'Người nhận trả', 'Ghi chú'],

    'yes' => 'Có',
    'no' => 'Không',

    'copy_state' => [
        'available' => 'Có sẵn',
        'on_loan' => 'Đang cho mượn',
        'held' => 'Đang giữ chỗ',
        'lost' => 'Đã mất',
        'retired' => 'Ngừng dùng',
    ],
    'condition' => [
        'perfect' => 'Nguyên vẹn',
        'slightly_worn' => 'Hơi cũ',
        'worn' => 'Cũ',
        'torn' => 'Rách',
        'missing_pages' => 'Mất trang',
        'written_on' => 'Bị vẽ vào',
    ],
    'membership_status' => [
        'pending' => 'Chờ duyệt',
        'active' => 'Đang hoạt động',
        'suspended' => 'Tạm khoá',
        'left' => 'Đã rời',
        'rejected' => 'Đã từ chối',
    ],
    // roleLabel deliberately has no word for 'reader' on screens (no
    // screen shows a role to someone who cannot hold it); a spreadsheet
    // column headed "Vai trò" with blank cells reads as missing data, so
    // the file supplies the word the readers list already counts in.
    'role' => [
        'reader' => 'Bạn đọc',
        'manager' => 'Quản lý',
        'admin' => 'Quản trị tủ sách',
    ],
    'loan_status' => [
        'active' => 'Đang mượn',
        'returned' => 'Đã trả',
        'lost' => 'Đã mất',
        'voided' => 'Đã huỷ',
    ],
];
