/**
 * The one definition of "this bucket is publicly readable".
 *
 * It is written here once and used twice: `tests/storage/s3.test.ts` applies it
 * to the test bucket with `PutBucketPolicy`, and
 * `tests/architecture/compose-grants-only-get-object.test.ts` reads the policy
 * document out of `compose.yaml` as text and asserts it is this same document.
 * Two hand-written copies of a security policy is how the shipped one came to
 * grant `s3:ListBucket` while the suite's did not, and the suite stayed green
 * precisely because it was not using what ships.
 *
 * ## Why exactly one action
 *
 * `s3:GetObject` and nothing else. In particular **not** `s3:ListBucket`, which
 * `mc anonymous set download` used to add here: with it, an unauthenticated
 * `GET /<bucket>/?list-type=2` answers 200 and paginates the key of every
 * avatar, cover and condition photograph in the parish. The avatars are
 * photographs of children. `objectKey()`'s opaque UUIDs — the whole of SDD
 * §6.8's privacy argument — are worth nothing the moment the keys can be
 * enumerated, because a reader does not have to guess a key they were handed.
 * The application never lists a bucket, so nothing is given up by removing it.
 *
 * ## Why the resource is the whole bucket rather than a prefix
 *
 * Asked in review, so the answer belongs in the file rather than in the review.
 * `arn:aws:s3:::<bucket>/*` covers `avatars/`, `book-covers/` and
 * `conditions/` alike, and that is correct rather than merely convenient: every
 * object this application writes is fetched directly by a browser from an
 * `<img>` tag, so there is no private prefix for a narrower policy to protect.
 * A prefix list would have to be kept in step with every new `objectKey()`
 * prefix, and the failure when someone forgot would be a broken image in
 * production and a working one locally — the ordering this slice keeps arguing
 * against. If a private object ever appears, it does not belong in this bucket;
 * SDD §6.8 and the plan's §5 say plainly that nothing in the requirements needs
 * one, which is also why there are no presigned URLs anywhere in the module.
 */
export function publicReadPolicy(bucket: string): PublicReadPolicy {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
}

export interface PublicReadPolicy {
  Version: string;
  Statement: {
    Effect: string;
    Principal: { AWS: string[] };
    Action: string[];
    Resource: string[];
  }[];
}
