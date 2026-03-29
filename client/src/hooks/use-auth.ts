import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLocation } from "wouter";

export function useAuth() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: () => api.get<{ user: any }>("/api/auth/me").catch(() => null),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<{ user: any }>("/api/auth/login", creds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/");
    },
  });

  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout", {}),
    onSuccess: () => {
      qc.clear();
      navigate("/login");
    },
  });

  return {
    user: data?.user || null,
    isLoading,
    isAuthenticated: !!data?.user,
    login,
    logout,
  };
}
