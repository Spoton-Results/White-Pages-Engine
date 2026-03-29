import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLocation } from "wouter";

const AUTH_KEY = ["/api/auth/me"];

export function useAuth() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => api.get<{ user: any }>("/api/auth/me").catch(() => null),
    retry: false,
    staleTime: 1000 * 60 * 10,
  });

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<{ user: any }>("/api/auth/login", creds),
    onSuccess: (responseData) => {
      // Set the auth data immediately so guards see authenticated state
      qc.setQueryData(AUTH_KEY, responseData);
      navigate("/");
    },
  });

  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout", {}),
    onSuccess: () => {
      // Clear auth data immediately
      qc.setQueryData(AUTH_KEY, null);
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
