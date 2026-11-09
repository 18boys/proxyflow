import { useNavigate } from 'react-router-dom';
import AuthForm from '../components/AuthForm';

export default function AuthPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {/* Background grid pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <div className="relative w-full max-w-md">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-7 sm:p-8 shadow-2xl">
          <AuthForm onSuccess={() => navigate('/dashboard')} />
        </div>
      </div>
    </div>
  );
}
