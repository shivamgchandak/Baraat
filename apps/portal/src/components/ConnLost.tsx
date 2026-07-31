export function ConnLost() {
  return (
    <div className="card py-10 text-center">
      <div className="text-3xl">📡</div>
      <p className="mt-2 font-semibold">Can&apos;t reach the server</p>
      <p className="mt-1 text-sm text-soft">
        Check that the backend API is running. Retrying automatically…
      </p>
    </div>
  );
}
