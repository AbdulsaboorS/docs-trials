export default {
  fetch(): Response {
    return Response.json(
      {
        error: "Implement the approved AI Search research task.",
      },
      { status: 501 },
    );
  },
} satisfies ExportedHandler;
