const storagePath = 'https://bihqfubtzecxjhkeognl.supabase.co/storage/v1/object/public/selfprint/originals/a0eec021-e0a8-40c7-add3-f2969b8fb283.pdf';

const url = new URL(storagePath);
const marker = url.pathname.match(/\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/);
console.log("pathname:", url.pathname);
console.log("marker:", marker);
if (marker?.[1]) {
  console.log("objectPath:", decodeURIComponent(marker[1]));
} else {
  console.log("objectPath is null!");
}
