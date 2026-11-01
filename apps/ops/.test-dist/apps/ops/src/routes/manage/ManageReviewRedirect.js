import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate, useParams } from "react-router-dom";
export function manageReviewTarget(id) {
    return "/manage/events/" + encodeURIComponent(id) + "/videos?status=pending";
}
export function ManageReviewRedirect() {
    const { id } = useParams();
    if (!id)
        return _jsx("div", { role: "alert", children: "\u30A4\u30D9\u30F3\u30C8\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002" });
    return _jsx(Navigate, { replace: true, to: manageReviewTarget(id) });
}
